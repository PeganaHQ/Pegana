# Data-source upgrades — backlog 2026-06-09

Prioritised backlog from a research pass on "should Pegana source its values
from better protocols / oracles?" (context7 for Pyth docs; web for
Switchboard/Birdeye/Helius/Jupiter; solana.new catalog cross-check).

## Framing — why "the best oracle" is the wrong question

Pegana is a **depeg detector, not a price feed**. Its signal is the *divergence
between independent sources*:

```
discount = 1 − (market_price / intrinsic_value)
```

- **intrinsic** (Sanctum / Hylo / on-chain) = what the asset *should* be worth (the backing)
- **market** (Jupiter / DexScreener) = what you actually get trading it now
- **oracle** (Pyth) = does **not** vote on the verdict — it supplies the
  confidence label (high/medium/low/unknown), the numéraire multiplier
  (SOL/USD), and FX derivation (BRZ via USD/BRL)

Refs: `crates/methodology/src/discount.rs`, `crates/engine-rs/src/main.rs:585+`,
ADR-0019 (missing-data invariant), ADR-0021 (premium carve-out), ADR-0023 (CR deadband).

Therefore consolidating onto a single "best" oracle would **defeat the product** —
the day that oracle is itself wrong/stale, you detect nothing. The three
independent legs *are* the methodology. "Better" here means only: (a) make a leg
**more independent / verifiable**, or (b) be able to **discard garbage prints** —
never collapse to one source. Latency products (ms-grade feeds) are a non-fit:
depegs are read over seconds-to-minutes.

---

## ⚠️ Timing gate — DO NOT implement before the verdict gate

Every item below except the two pure-software gates (#3, partly #4) touches the
**indexer/engine**. We are in the calibration window; the standing rule is **never
recreate engine/indexer mid-calibration** (it resets the window). Verdict gate is
**2026-06-11**.

- These are **post-verdict / post-launch** items.
- When implementing: RPC + stake-pool reads are **indexer** changes → recreate
  the **indexer only** (engine untouched, as done for the Jupiter keyed migration).
- Source-methodology changes (direct stake-pool vs Sanctum) change the discount
  numbers by a few bps → **ADR + replay before shipping** (same bar as ADR-0023).

---

## DO — high value, mostly free

### 1. Public RPC → Helius free tier  ·  reliability  ·  $0
**What:** The direct on-chain NAV reads (Hylo, Solayer sUSD, Piggybank pbUSDC) +
the engine's on-chain alert commit run on **public RPC**
(`api.mainnet-beta.solana.com` + `solana-rpc.publicnode.com` fallback,
`crates/indexer-rs/src/config.rs:53-66`, `crates/engine-rs/src/main.rs:1437`).
Public RPC is aggressively rate-limited, has no SLA, and frequently throttles
`getProgramAccounts` — the detector can **go blind silently** under load.

**Why it's the cheapest fix:** Helius free tier = 1M credits/mo, 10 rps,
gPA 5/s, WebSockets included, no card. Vastly more than a few-account periodic
poll needs. QuickNode free (~10M credits/mo) is an equivalent fallback. Triton
($500+/mo, MEV-grade) is overkill — skip.

**Where to plug in:** env-only change — set `SOLANA_RPC_URL` /
`SOLANA_RPC_URL_FALLBACK` to the Helius endpoint on the indexer host `.env`,
recreate indexer only. No code change.

**Bonus:** `accountSubscribe` (WS) lets the direct NAV reads move from polling to
**push** (notify on pool-account change) — fewer calls, lower intrinsic latency.
Optional, separate follow-up.

### 2. Read SPL stake-pool accounts directly for major LSTs  ·  trust-minimization  ·  $0
**What:** LST intrinsic `sol_per_lst` is currently read from **Sanctum's HTTP API**
(`crates/indexer-rs/src/sources/sanctum.rs`). Convenient, but it's a **trust
dependency on a third-party server** — the "independent intrinsic" leg is really
an HTTP call that can stale/err/go down.

**Why:** The SPL stake-pool program exposes `total_lamports` and
`pool_token_supply` in the pool account → `intrinsic = total_lamports /
pool_token_supply`, computed by us. Removes Sanctum's server from the trust path
and makes this leg as independent as the Hylo/Solayer/Piggybank reads we already
do. Best alignment with the verifiability pitch.

**Where to plug in:** same RPC plumbing as the existing direct reads. Need the
pool account address + layout per LST (SPL stake-pool is a stable schema;
Marinade/Jito use it or close variants). Keep Sanctum extra-api as a
**cross-check / fallback** for exotic LSTs whose layout isn't mapped — the
"Sanctum says X / on-chain says Y" divergence is a free integrity check.
**Needs ADR + replay** (numbers shift a few bps).

### 3. Gate on Pyth confidence-interval width + staleness  ·  quality  ·  $0
**What:** Pyth's confidence interval measures **publisher disagreement, NOT
cross-venue dislocation** (Pyth docs, confirmed via context7). A tight `conf`
does **not** mean "no depeg" — it means publishers agree.

**Why:** Correct use is to treat wide `conf` + staleness as a **reliability gate**
("discard / flag this print as unreliable"), not as the signal. We already treat
missing Pyth as `unknown` (ADR-0019). Confirm we also gate on the `conf` *width*;
if not, this is the highest-value zero-cost improvement.

**Where to plug in:** `crates/engine-rs/src/main.rs:1045-1078`
(`pyth_confidence_for_asset`). Pure software — could land independent of the RPC
work, but still verify it doesn't perturb calibration before merging.

### 4. Birdeye for liquidity-depth gating  ·  quality  ·  free/Lite
**What:** The worst failure mode of a depeg monitor is alerting on a price from a
**dust pool** — exactly the pbUSDC/DexScreener class bug ($1.46 vs ~$1.10 NAV,
see `project_pbusdc_dexscreener_dataquality`). DexScreener prints raw pair data
with no depth filter.

**Why:** Birdeye returns price **plus liquidity/market-depth per pair** — the
dimension we lack. Use it to *discard* thin-pair prints rather than alert on
them. Free tier (30k CU/mo, 1 rps) likely covers the periodic poll; Lite $39/mo
if scaling.

**Where to plug in:** new gate in the market-source path; keep DexScreener as a
cheap cross-check (already has source-premium-gate + watchdog dedup).

### 5. Confirm Jupiter Price API V3 + keyed  ·  maintenance  ·  $0
**What/Why:** V2 was deprecated 2026-08-01; old token API gone 2026-09-30. V3
returns one heuristic-cleaned `usdPrice` + `blockId` (recency check) and has
outlier elimination that partly helps the thin-pair problem. Web proxy already on
keyed `JUP_API_KEY` (`project_jupiter_keyed_migration`). Just confirm V3 endpoint
+ keyed access are in use everywhere; mind concurrency=2 on the free tier and the
**2026-06-30** free-tier expiry.

---

## OPTIONAL — second wave

### 6. Switchboard On-Demand as a 2nd independent oracle  ·  free
**What/Why:** The only oracle add that brings *genuine independence* — own node
set, Solana-native, free. Cross-checking Pyth × Switchboard catches "the oracle
itself is wrong/stale", strictly additive to the triangulation. Do it only if
hardening the oracle leg becomes a priority; otherwise defer. (Custom On-Demand
feeds may need periodic cranking — verify the read path first.)

---

## SKIP

- **Pyth Pro / Lazer, Switchboard Surge, RedStone Bolt** — latency products (ms);
  depeg detection doesn't need them, and same publisher network = no new independence.
- **Chainlink Data Feeds on Solana** — coverage too thin for the long-tail
  stables/LSTs; at best a USDC/USDT sanity feed Pyth+Jupiter already give.
- **Triton One RPC** — no real free tier, $500+/mo, MEV-grade; overkill.
- **CoinGecko / CMC** — slow (cached), not account-aware; at most a USDC/USDT
  off-chain sanity check.
- **Ondo / "stablecoin depeg oracle"** — doesn't exist as a pluggable source.
  Ondo is an RWA *issuer* (USDY/OUSG) — a thing to **monitor**, not a feed.

## WATCH

- **RedStone** — the only oracle whose asset breadth (yield-bearing stables /
  LSTs / RWAs) overlaps Pegana's list. Today its Solana surface is RWA-skewed and
  Wormhole-Query-gated. Becomes relevant **if/when Pegana adds RWA-backed stables**.

---

## One-line theme

For a triangulating depeg monitor, the upgrades that matter make a leg **more
independent / trust-minimized** (direct stake-pool reads, dedicated RPC) or let
you **discard low-quality prints** (confidence gating, liquidity depth) — never
the ones that make a single number faster or fancier.
