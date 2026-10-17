# Deferred work — handoff 2026-05-28

Closing-out doc for the `feat/post-merge-cleanup` session. Captures
everything that was intentionally left for a follow-up so nothing falls
through the cracks.

## Backend work — required to remove frontend placeholders

### 1. Jupiter exit-liquidity quote pipeline — ✅ RESOLVED

**Status (2026-05-31):** RESOLVED — `web/components/organisms/exit-liquidity.tsx`
renders live Jupiter quotes (the placeholder is gone). Shipped via the
**client-side path** (the component queries Jupiter directly), not the
`/v1/assets/:symbol/exits` backend route sketched below — that route was not
built. Original deferral note kept for context.

**What:** `/asset/[symbol]` Overview tab has an "Exit liquidity" section
that currently renders a "Quote pipeline calibrating" placeholder. The
intent is a 3-row table showing slippage for redeeming $100k / $1M / $10M
of the asset back to USDC via Jupiter.

**Why deferred:** needs a backend route that calls Jupiter's quote API
with the asset's mint, three notional sizes, and returns best route +
expected USDC + slippage % + est fill blocks. No frontend mock for it —
real numbers are the value.

**Where to plug in:**
- New route `/v1/assets/:symbol/exits` returns:
  ```json
  {
    "rows": [
      { "size_usd": 100000, "best_route": "Whirlpool jitoSOL/USDC", "received_usdc": "99884.20", "slippage_bps": 12, "est_fill": "< 1 block" },
      ...
    ],
    "as_of": "2026-05-28T03:00:00Z"
  }
  ```
- Frontend component: `web/components/organisms/exit-liquidity.tsx` —
  drop the placeholder div, render the table from the API response.

### 2. dSOL / asset-list filter — ✅ RESOLVED

**Status (2026-05-31):** RESOLVED — option (b) shipped: `crates/api-rs`
(`assets.rs`) filters `is_active`, so `/v1/assets` no longer returns
`active=false` rows (dSOL and the other inactive entries are excluded). The
entry stays in `assets.toml` for historical continuity. Original deferral note
kept for context.

**What:** dSOL has `active=false` in `assets.toml` (engine skips). Frontend
also filters it (`isDeprecated()`) from dashboard listing, sidebar counts,
peer-comparison and recovery-confidence peer math. But `/asset/dSOL`
still loads via direct URL and the API still returns it in `/v1/assets`.

**Why deferred:** the team may want a "deprecated assets" surface in the
future for historical research. Hard-removing it from the API loses that
optionality.

**Decision needed:**
- (a) Remove dSOL entry entirely from assets.toml (loses history)
- (b) Keep entry but make `/v1/assets` exclude `active=false` rows
- (c) Add `active` field to AssetCardData so frontend can filter at the
  hook level

## Frontend deferred

### 3. /asset Mechanism / Risk / Identity tabs visual lift

**What:** these three tabs in the rebuilt `/asset/[symbol]` page reuse
the existing organisms verbatim (MechanismFlow, AlertPolicy, YieldSource,
SafetyGrade, PeerComparison, IdentityRow, AssetActionStrip). Each organism
has its own internal padding + section borders inherited from the pre-tab
design.

**Why deferred:** would require touching 7 internal components to
homogenize their visual register with the new Overview/History pattern
(h2 + section-sub + tight padding). Functional today.

**Approach if picked up:**
- Wrap each organism in a `<TabSection>` helper that supplies consistent
  h2 + section-sub above
- Strip the organisms' internal section-level padding so the wrapper
  controls spacing
- File-by-file pass with screenshots before/after

### 4. /asset backlog features (no data pipeline yet)

Features that would make the asset page genuinely useful but need new
data sources we don't ship yet:

- **Backing / reserves breakdown** (stables) — treemap of who custodies
  the reserves, by counterparty
- **Holder concentration** — top wallet % + diff from 7d ago (whale
  movement signal)
- **Issuer feed** — last 3 posts from issuer's Twitter / Telegram
- **Mint/redeem queue depth** (CDP / yield stables) — backlog + ETA
- **Audit + governance summary** — last audit date, who, recent proposals
- **Yield decomposition** (yield stables) — APR sourced from lending,
  carry, etc.

Each needs its own ingestion pipeline. Not blocking — slot exists
visually (Risk tab is a natural home).

### 5. /assets plural — catalog / explorer page

**What:** during the /asset rebuild discussion we considered creating a
new `/assets` plural route as a Pyth-Terminal-style catalog (filter rail
+ dense feed table, deeper than the dashboard). User picked option (a)
"only rebuild /asset/[symbol] detail", so /assets plural was never built.

**Why deferred:** Dashboard already serves the "browse all" role for
operators. /assets plural would only matter if we want a public-facing
catalog distinct from the operating surface.

### 6. /compare improvements

**What:** /compare existed before this session and shipped as-is. User
explicitly asked for compare improvements in earlier scoping ("aprimorar
e improve") but later said "Não faça compare & navbar" for this round.

**Why deferred:** explicit user instruction.

## Visual / brand follow-ups

### 7. Numbered nav resurrection or rename

The topbar used to have `01 DASHBOARD / 02 EVENTS / 03 COMPARE /
04 ACCOUNT` numbered nav. User asked to remove the numbers (this session,
final state is editorial sans Geist medium centered). Numbered nav still
exists in:
- AccountSidebar (`01 Profile / 02 Subscriptions / 03 Alerts / 04 Webhooks`)
- Asset detail tabs (`01 Overview / 02 History / 03 Mechanism / 04 Risk /
  05 Identity`)

If the no-numbers rule generalizes brand-wide, those need to follow.
Current take: numbers feel right within a section (where they read as
table-of-contents) and wrong at the global nav (where they read as
engineering-tool). No change needed unless user revisits.
