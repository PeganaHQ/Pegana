# Pegana Asset Expansion — Design Spec v2 (GRILLED + on-chain verified)

**Date:** 2026-06-23
**Goal:** Add the complete set of significant net-new pegged/yield assets to Pegana —
**33 data-only (Tier 1)** + **a generic SPL-stake-pool adapter (Tier 2)** for non-Sanctum LSTs.
**Architecture:** Tier 1 reuses existing intrinsic/market code-paths → pure data
(`assets.toml` asset blocks + `[pyth_feeds]` + `[pyth_staleness]` + one DB migration). Tier 2
adds ONE new Rust intrinsic adapter (`spl_stake_pool`). Huma PST collapsed to data-only;
Perena USD* deferred.
**Tech stack:** Rust (indexer-rs sources, common-verify config), TOML, PostgreSQL/TimescaleDB,
`cargo xtask verify-assets`, `scripts/deploy.sh --migrate`.

> **This v2 supersedes v1 after an adversarial grilling pass (5 read-only Opus audits of the
> Pyth plumbing, config/DB schema, engine, Tier-2 adapters, and Jupiter).** Every claim below
> is backed by a `file:line` citation or a live on-chain/Hermes check. Catalog:
> `docs/strategy/2026-06-23-asset-expansion-discovery-results.md`.

---

## 0. What the grilling changed (changelog vs v1)
1. **🔴 ADDED the `[pyth_feeds]` requirement (v1 missed it — would have shipped 6 dead assets).**
   The indexer subscribes to Pyth feeds ONLY via the `[pyth_feeds]` name→id map
   (`indexer-rs/src/state.rs:100-106`, `pyth.rs:245-250`); the per-asset `pyth_feed_id` field is
   **decorative/unused at runtime**. `verify-assets` does NOT check feed coverage. → §1.4.
2. **🔴 ADDED `[pyth_staleness.overrides]` for the two `.RR` feeds** — RR feeds step slowly;
   the 30s default would false-stale eUSX/PST → UNKNOWN. Mirror the SUSDE/SYRUPUSDC 36h override. → §1.4.
3. **🟢 Huma PST → Tier 1 data-only** (no adapter): Pyth `Crypto.PST/USDC.RR` confirmed live
   (`0x675e36f84a6be779ed793c71eb5c03151e1866c125767f46933626e0610af84d`, value ~1.1108).
4. **🟢 eUSX framing fixed** — `EUSX/USX.RR` (USX-denominated) is NOT anomalous; sUSDe
   (`SUSDE/USDE.RR`) and syrupUSDC (`SYRUPUSDC/USDC.RR`) already use non-USD-quoted `.RR` with
   the same "underlying≈$1" approximation. Accept it (Q1 resolved → accept).
5. **🟡 Perena USD* → DEFERRED.** v1's NAV formula (`Σ vaults / supply`) yields ~$0.034, not the
   real ~$1.074 (it's a Numéraire curve-AMM needing the curve invariant from a 4024-byte bytemuck
   `StablePool`). The existing `PerenaUsdStarPool {pool, underlying, program}` variant encodes the
   WRONG model. ~$2.3k DEX liquidity → ~zero divergence signal. Multi-day RE. Not in this build.
6. **🟡 REJECTED an agent error, then DISCARDED the assets:** a Tier-2 audit claimed
   "fwdSOL=dumSOL, pdSOL=aeroSOL". Verified FALSE — `cPQPBN…`=Sanctum `dumSOL` and `aeroX…`=Sanctum
   `aeroSOL` are *different* tokens, not the $133M fwdSOL / $75M pdSOL. Their real mints were
   unconfirmed, so **fwdSOL/pdSOL/gtSOL were DISCARDED by user decision (2026-06-23).** Tier-2
   adapter now covers exactly 3 verified LSTs (STKESOL/rkuSOL/corvusSOL) — Q4 fully resolved.
7. **🟢 Q3 resolved:** all 25 Sanctum LST symbols resolve live (both `/v1/lsts` and
   `/v1/sol-value/current`), all `decimals=9`, all `spl` (Tokenkeg) — none are Token-2022.
8. Citation fixes: jupiter pre-filter is `sources/jupiter.rs:99` (not :92); the code default for
   `JUPITER_MAX_CONCURRENT` is **1** (`config.rs:82`), not 2 — prod MUST set 4 (§1.5).

## 0b. Hard constraints (verified)
- **All new assets `monitoring_only=true`** via a `metadata` jsonb key (`metadata->>'monitoring_only'`,
  read at `dispatcher-rs/src/webhook_queries.rs:76-78`). Not an `assets.toml` field.
- **Token-2022 proven** — PYUSD runs `token_2022 + fixed_1_usd + jupiter_usd` (`assets.toml:174`);
  `verify-assets` checks owner program (`xtask/src/main.rs:169-179`).
- **Engine learns assets from `assets.toml` at BOOT only** (`engine-rs/src/main.rs:321-337`) — a DB
  row alone is insufficient; deploy MUST restart engine+indexer (`deploy.sh --migrate` does both).
- **Jupiter loop** = shared round-robin over `market.kind==jupiter_usd` only (pre-filter
  `jupiter.rs:99`); cycle = `ceil(N÷concurrency)×2500ms`. Tier 1 takes it 19→46 jupiter assets
  → **~30s @conc4 / ~57s @conc2**. Set `JUPITER_MAX_CONCURRENT=4` (paid Jupiter; free tier ends
  **2026-06-30**, per `docs/data-source-upgrades-2026-06-09.md:124`). Steady RPS at conc4 = 1.6.
- **DexScreener liquidity is useless for LSTs** (route via Sanctum/Jupiter) → LST market MUST be
  `jupiter_usd`. (PST is a stable with a real DEX pair → `dex_screener_usd` is correct for it.)

---

## 1. TIER 1 — data-only (33 assets) — fully verified

### 1.1 File structure
- **Modify** `assets.toml`: (a) append 33 `[[assets]]` blocks (§1.3); (b) append 7 `[pyth_feeds]`
  entries + 2 `[pyth_staleness.overrides]` (§1.4). **Both edits are mandatory.**
- **Create** `migrations/0053_asset_expansion.sql` — `INSERT … ON CONFLICT (symbol) DO UPDATE`
  for all 33 (§1.5), mirroring `migrations/0047_phase0_activation.sql`.
- **Create** `crates/indexer-rs/tests/` (or extend `pyth.rs` tests) — a feed-coverage test (§1.7).
- **Create** `docs/operations/asset-expansion-2026-06-23.md` — activation note.

### 1.2 Verified config schema (`crates/common-verify/src/lib.rs`)
- `AssetClass` (snake_case): `stable_fiat`(:30), `stable_dn`(:33), `stable_yield`(:43), `lst`(:29). ✅
- `PegTarget` (verbatim caps, NO rename): `USD`(:132), `SOL`(:133). ✅
- `TokenProgram`: `spl`(:141), `token_2022`(explicit rename :143). ✅
- `IntrinsicStrategy`(tag `kind`): `fixed_1_usd`(:152), `sanctum_lst {symbol}`(:149), `pyth_redemption_rate {feed}`(:178). ✅
- `MarketStrategy`(tag `kind`): `pyth_spot {feed}`(:236), `jupiter_usd {numeraire,numeraire_feed}`(:226), `dex_screener_usd`(:243). ✅
- Thresholds: `assets.toml` uses `thresholds_bps = {drift,depeg,critical}` (flattened `ThresholdsConfig`, :277-296; engine requires it `engine-rs/src/main.rs:711-715`). DB jsonb uses `{"drift_bps","depeg_bps","critical_bps"}` (both consumed; methodology accepts both, `methodology/src/thresholds.rs:197-211`).
- DB `public.assets` (`migrations/0001_initial.sql:29-44`, +`0003`): `class`/`peg_target`/`token_program` are ENUM types (all spec values valid); `intrinsic_kind`/`market_kind` are TEXT (no gate); only CHECK = `decimals BETWEEN 0 AND 18`; `lower(symbol)` unique (`0045:14`). Column order matches `0047:13-15`.

### 1.3 `assets.toml` asset blocks

**Group 1 — 6 stables (`fixed_1_usd`).** 5 use `pyth_spot` (zero Jupiter); CASH uses `jupiter_usd`.
```toml
[[assets]]
symbol = "USX"
name = "Solstice USX"
mint = "6FrrzDk5mQARGc1TDYoyVnSyRdds1t4PbtohCD6p3tgG"
verified = true
decimals = 6
token_program = "spl"
class = "stable_dn"
peg_target = "USD"
intrinsic = { kind = "fixed_1_usd" }
market = { kind = "pyth_spot", feed = "USX/USD" }
pyth_feed_id = "0x80950327494d0e7f29bdddb061ed7d1def1d712cec73bc167af02f0664137a16"
thresholds_bps = { drift = 25, depeg = 100, critical = 300 }

[[assets]]
symbol = "USDG"
name = "Global Dollar"
mint = "2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH"
verified = true
decimals = 6
token_program = "token_2022"
class = "stable_fiat"
peg_target = "USD"
intrinsic = { kind = "fixed_1_usd" }
market = { kind = "pyth_spot", feed = "USDG/USD" }
pyth_feed_id = "0xdaa58c6a3ce7d4b9c46c32a6e646012c17c4a2b24c08dd8c5e476118b855a7da"
thresholds_bps = { drift = 15, depeg = 50, critical = 200 }

[[assets]]
symbol = "USD1"
name = "World Liberty Financial USD"
mint = "USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB"
verified = true
decimals = 6
token_program = "spl"
class = "stable_fiat"
peg_target = "USD"
intrinsic = { kind = "fixed_1_usd" }
market = { kind = "pyth_spot", feed = "USD1/USD" }
pyth_feed_id = "0x0a2425d43486780990d8b63543029e20556be51fd756cca584212f4d539611d4"
thresholds_bps = { drift = 20, depeg = 75, critical = 250 }

[[assets]]
symbol = "USDu"
name = "USDu"
mint = "9ckR7pPPvyPadACDTzLwK2ZAEeUJ3qGSnzPs8bVaHrSy"
verified = true
decimals = 6
token_program = "token_2022"
class = "stable_fiat"
peg_target = "USD"
intrinsic = { kind = "fixed_1_usd" }
market = { kind = "pyth_spot", feed = "USDu/USD" }
pyth_feed_id = "0x9c26b01925ed603f7c90deb29cd88751c580436333a7dca20a64a2c63785f502"
thresholds_bps = { drift = 25, depeg = 100, critical = 300 }

[[assets]]
symbol = "CASH"
name = "CASH (Bridge)"
mint = "CASHx9KJUStyftLFWGvEVf59SGeG9sh5FfcnZMVPCASH"
verified = true
decimals = 6
token_program = "token_2022"
class = "stable_fiat"
peg_target = "USD"
intrinsic = { kind = "fixed_1_usd" }
market = { kind = "jupiter_usd", numeraire = "USDC", numeraire_feed = "USDC/USD" }
pyth_feed_id = ""
thresholds_bps = { drift = 25, depeg = 100, critical = 300 }

[[assets]]
symbol = "AUSD"
name = "Agora Dollar"
mint = "AUSD1jCcCyPLybk1YnvPWsHQSrZ46dxwoMniN4N2UEB9"
verified = true
decimals = 6
token_program = "token_2022"
class = "stable_fiat"
peg_target = "USD"
intrinsic = { kind = "fixed_1_usd" }
market = { kind = "pyth_spot", feed = "AUSD/USD" }
pyth_feed_id = "0xd9912df360b5b7f21a122f15bdd5e27f62ce5e72bd316c291f7c86620e07fb2a"
thresholds_bps = { drift = 20, depeg = 75, critical = 250 }
```

**Group 2 — 2 yield-stables (`pyth_redemption_rate`).** Intrinsic = the `.RR` NAV; market = real source.
```toml
[[assets]]
symbol = "eUSX"
name = "Solstice Earn USX"
mint = "3ThdFZQKM6kRyVGLG48kaPg5TRMhYMKY1iCRa9xop1WC"
verified = true
decimals = 6
token_program = "spl"
class = "stable_yield"
peg_target = "USD"
intrinsic = { kind = "pyth_redemption_rate", feed = "EUSX/USX.RR" }
market = { kind = "jupiter_usd", numeraire = "USDC", numeraire_feed = "USDC/USD" }
pyth_feed_id = ""
thresholds_bps = { drift = 50, depeg = 200, critical = 500 }

[[assets]]
symbol = "PST"
name = "Huma PayFi Strategy Token"
mint = "59obFNBzyTBGowrkif5uK7ojS58vsuWz3ZCvg6tfZAGw"
verified = true
decimals = 6
token_program = "spl"
class = "stable_yield"
peg_target = "USD"
intrinsic = { kind = "pyth_redemption_rate", feed = "PST/USDC.RR" }
market = { kind = "dex_screener_usd" }
pyth_feed_id = ""
thresholds_bps = { drift = 30, depeg = 100, critical = 250 }
```

**Group 3 — 25 LSTs.** UNIFORM template (`sanctum_lst` + `jupiter_usd{SOL}`); `intrinsic.symbol`
MUST equal the Sanctum-registry symbol (verified present for all 25). Only `symbol`/`name`/`mint` vary.
```toml
[[assets]]
symbol = "<SYM>"
name = "<NAME>"
mint = "<MINT>"
verified = true
decimals = 9
token_program = "spl"
class = "lst"
peg_target = "SOL"
intrinsic = { kind = "sanctum_lst", symbol = "<SYM>" }
market = { kind = "jupiter_usd", numeraire = "SOL", numeraire_feed = "SOL/USD" }
pyth_feed_id = ""
thresholds_bps = { drift = 55, depeg = 140, critical = 300 }
```
| SYM | NAME | MINT |
|---|---|---|
| BNSOL | Binance Staked SOL | `BNso1VUJnh4zcfpZa6986Ea66P6TCp59hvtNJ8b1X85` |
| dynoSOL | dynoSOL | `DYNoyS3x5qgbccZg7RPXagm4xQzfnm5iwd9o8pMyJtdE` |
| PSOL | Phantom Staked SOL | `pSo1f9nQXWgXibFtKf7NWYxb5enAM4qfP6UJSiXRQfL` |
| JSOL | JPOOL Solana Token | `7Q2afV64in6N6SeZsAAB81TJzwDoD6zpqmHkzi9Dcavn` |
| hSOL | Helius Staked SOL | `he1iusmfkpAdwvxLNGV8Y1iSbj4rUy6yMhEA3fotn9A` |
| edgeSOL | Edgevana Staked SOL | `edge86g9cVz87xcpKpy3J77vbp4wYd9idEV562CCntt` |
| jagSOL | JagPool Staked SOL | `jag58eRBC1c88LaAsRPspTMvoKJPbnzw9p9fREzHqyV` |
| definSOL | Definity Staked SOL | `DEF1NXSZ8Th9n28hYBayrFtx9bj1EwwTiy3mhHEB9oyA` |
| sharkSOL | SharkPool Staked SOL | `BdMLRC2gKyFu8FRBErazzpEaKmB1jcVB9Eq1rXXFm4EV` |
| BulkSOL | BULK Staked SOL | `BULKoNSGzxtCqzwTvg5hFJg8fx6dqZRScyXe5LYMfxrn` |
| bonkSOL | bonkSOL | `BonK1YhkXEGLZzwtcvRTip3gAL9nCeQD7ppZBLXhtTs` |
| cgntSOL | Cogent SOL | `CgnTSoL3DgY9SFHxcLj6CgCgKKoTBr6tp4CPAEWy25DE` |
| LST | Liquid Staking Token (Marginfi) | `LSTxxxnJzKDFSLr4dUkPcmCf5VyryEqzPLz5j4bpxFp` |
| CDCSOL | Crypto.com Staked SOL | `CDCSoLckzozyktpAp9FWT3w92KFJVEUxAU7cNu2Jn3aX` |
| bpSOL | bpSOL | `BPSoLzmLQn47EP5aa7jmFngRL8KC3TWAeAwXwZD8ip3P` |
| haSOL | Hanabi Staked SOL | `haSo1Vz5aTsqEnz8nisfnEsipvbAAWpgzRDh2WhhMEh` |
| laineSOL | Laine Stake Token | `LAinEtNLgpmCP9Rvsf5Hn8W6EhNiKLZQti1xfWMLy6X` |
| xandSOL | Xandeum Staked SOL | `XAnDeUmMcqFyCdef9jzpNgtZPjTj3xUMj9eXKn2reFN` |
| raiSOL | Rakurai Staked SOL | `Ra1so1sTkvX3PorAM9ewqrsUMz9sPSbfFZ5oZUjN4oc` |
| picoSOL | picoSOL | `picobAEvs6w7QEknPce34wAE4gknZA9v5tTonnmHYdX` |
| mangoSOL | Mango Staked SOL | `MangmsBgFqJhW4cLUR9LxfVgMboY1xAoP8UUBiWwwuY` |
| iASOL | inshAllah SOL | `HALALGvdNJ8u1J3uFFSsba1tyYPRF3vnYfCQ3CpJasfD` |
| lanternSOL | Lantern Staked SOL | `LnTRntk2kTfWEY6cVB8K9649pgJbt6dJLS1Ns1GZCWg` |
| RoXSOL | RockawayX Staked SOL | `roxDFxTFHufJBFy3PgzZcgz6kwkQNPZpi9RfpcAv4bu` |
| proSOL | ProStaking SOL | `jucy5XJ76pHVvtPZb5TKRcGQExkwit2P5s4vY8UzmpC` |

### 1.4 🔴 MANDATORY `assets.toml` registry edits (v1 missed these — without them, 7 assets stay UNKNOWN)

Append to `[pyth_feeds]` (around `assets.toml:676`) — IDs verified live on Hermes:
```toml
"USX/USD"     = "0x80950327494d0e7f29bdddb061ed7d1def1d712cec73bc167af02f0664137a16"
"USDG/USD"    = "0xdaa58c6a3ce7d4b9c46c32a6e646012c17c4a2b24c08dd8c5e476118b855a7da"
"USD1/USD"    = "0x0a2425d43486780990d8b63543029e20556be51fd756cca584212f4d539611d4"
"USDu/USD"    = "0x9c26b01925ed603f7c90deb29cd88751c580436333a7dca20a64a2c63785f502"
"AUSD/USD"    = "0xd9912df360b5b7f21a122f15bdd5e27f62ce5e72bd316c291f7c86620e07fb2a"
"EUSX/USX.RR" = "0xf36e12e65d2969b242fb97d3ebaa32ec55d5794189b64d1a07dc4f41425c9378"
"PST/USDC.RR" = "0x675e36f84a6be779ed793c71eb5c03151e1866c125767f46933626e0610af84d"
```
> The feed NAME here must EXACTLY equal the `feed = "..."` string in each asset block. CASH needs
> no entry (jupiter_usd); the LSTs reuse already-registered `SOL/USD` + `USDC/USD`.

Append to `[pyth_staleness.overrides]` (around `assets.toml:706`) — `.RR` feeds step daily, the 30s
default would false-stale them:
```toml
"EUSX/USX.RR" = 129600   # 36h, mirrors SUSDE/SYRUPUSDC RR overrides
"PST/USDC.RR" = 129600   # 36h
```

### 1.5 `migrations/0053_asset_expansion.sql`
One `INSERT … VALUES (…) ON CONFLICT (symbol) DO UPDATE SET …` (full DO-UPDATE clause copied
verbatim from `0047:103-117`) for all 33 rows. Columns (order from `0047:13-15`):
`symbol, mint, name, class, peg_target, decimals, token_program, intrinsic_kind, intrinsic_cfg,
market_kind, market_cfg, pyth_feed_id, thresholds, is_active, metadata`.
- `intrinsic_cfg` = `'{}'::jsonb` for fixed_1_usd; `'{"symbol":"<SYM>"}'::jsonb` for sanctum_lst;
  `'{"feed":"EUSX/USX.RR"}'::jsonb` / `'{"feed":"PST/USDC.RR"}'::jsonb` for the two RR assets.
- `market_cfg` = `'{"feed":"USX/USD"}'::jsonb` (pyth_spot); `'{"numeraire":"USDC","numeraire_feed":"USDC/USD"}'::jsonb` or `…"SOL"…"SOL/USD"…` (jupiter_usd); `'{}'::jsonb` (dex_screener_usd, PST).
- `pyth_feed_id` = the hex for record-keeping (runtime-dead, but populate for the 5 stables; `''` else).
- `thresholds` = `'{"drift_bps":N,"depeg_bps":N,"critical_bps":N}'::jsonb`.
- `metadata` = `'{"monitoring_only":true,"added":"2026-06-23 asset-expansion batch"}'::jsonb`.
- `is_active` = TRUE.

Exact row samples:
```sql
('USX','6FrrzDk5mQARGc1TDYoyVnSyRdds1t4PbtohCD6p3tgG','Solstice USX','stable_dn','USD',6,'spl',
 'fixed_1_usd','{}'::jsonb,'pyth_spot','{"feed":"USX/USD"}'::jsonb,
 '0x80950327494d0e7f29bdddb061ed7d1def1d712cec73bc167af02f0664137a16',
 '{"drift_bps":25,"depeg_bps":100,"critical_bps":300}'::jsonb,TRUE,
 '{"monitoring_only":true,"added":"2026-06-23 asset-expansion batch"}'::jsonb),
('CASH','CASHx9KJUStyftLFWGvEVf59SGeG9sh5FfcnZMVPCASH','CASH (Bridge)','stable_fiat','USD',6,'token_2022',
 'fixed_1_usd','{}'::jsonb,'jupiter_usd','{"numeraire":"USDC","numeraire_feed":"USDC/USD"}'::jsonb,
 '','{"drift_bps":25,"depeg_bps":100,"critical_bps":300}'::jsonb,TRUE,
 '{"monitoring_only":true,"added":"2026-06-23 asset-expansion batch"}'::jsonb),
('PST','59obFNBzyTBGowrkif5uK7ojS58vsuWz3ZCvg6tfZAGw','Huma PayFi Strategy Token','stable_yield','USD',6,'spl',
 'pyth_redemption_rate','{"feed":"PST/USDC.RR"}'::jsonb,'dex_screener_usd','{}'::jsonb,
 '','{"drift_bps":30,"depeg_bps":100,"critical_bps":250}'::jsonb,TRUE,
 '{"monitoring_only":true,"added":"2026-06-23 asset-expansion batch"}'::jsonb),
('BNSOL','BNso1VUJnh4zcfpZa6986Ea66P6TCp59hvtNJ8b1X85','Binance Staked SOL','lst','SOL',9,'spl',
 'sanctum_lst','{"symbol":"BNSOL"}'::jsonb,'jupiter_usd','{"numeraire":"SOL","numeraire_feed":"SOL/USD"}'::jsonb,
 '','{"drift_bps":55,"depeg_bps":140,"critical_bps":300}'::jsonb,TRUE,
 '{"monitoring_only":true,"added":"2026-06-23 asset-expansion batch"}'::jsonb),
```
(USDG/USD1/USDu/AUSD follow USX with their feed/mint/thresholds; eUSX follows PST shape with
`jupiter_usd` market; the 24 remaining LSTs follow BNSOL with their symbol/mint/name.)

### 1.6 Jupiter concurrency
Set `JUPITER_MAX_CONCURRENT=4` in the prod `~/pegana/.env` BEFORE recreating the indexer (code
default is **1**, `config.rs:82` — must not rely on it). Gated on paid Jupiter (free tier ends
2026-06-30). `jupiter_tick_ms=2500`. Result: 46 jupiter assets → ~30s/cycle. (Fallback conc=2 →
~57s, acceptable for beta but slows core stables too.)

### 1.7 Verify / test / deploy / rollback
1. **`cargo xtask verify-assets`** (needs live mainnet RPC + Sanctum reachability) — checks mint
   owner==token_program, decimals@offset44, and every `sanctum_lst` symbol ∈ Sanctum `/v1/lsts`.
   ⚠️ It does NOT check `[pyth_feeds]` coverage, pyth_feed_id, or thresholds.
2. **NEW feed-coverage test** (mirror `pyth.rs:491-560`'s `assets_toml_wires_usdy_to_usdy_rr_feed`):
   assert each new `pyth_spot`/`pyth_redemption_rate` asset's `feed` is present in `[pyth_feeds]`.
   This is the only automated guard against the §1.4 gap → MUST add it.
3. `cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test` — all green.
4. `scripts/deploy.sh --migrate` (runs `0053` BEFORE engine/indexer restart — FK + engine reloads
   `assets.toml` only at boot).
5. **Post-deploy:** each of the 33 transitions `UNKNOWN → PEGGED` on `/v1/assets` (the 7 pyth/RR
   assets prove §1.4 worked); web shows MONITORING badge automatically; confirm indexer
   `effective_rps`/cycle in logs.
6. **Rollback:** `UPDATE assets SET is_active=FALSE WHERE symbol IN (…33…);` + revert assets.toml + recreate.

---

## 2. TIER 2 — ONE adapter: generic SPL stake-pool (non-Sanctum LSTs)

Huma PST is now Tier 1 (data-only). Perena is deferred (§3). So Tier 2 is a SINGLE new adapter.

### 2.1 House-style checklist (every new indexer source MUST follow — from solayer_susd/hylo/piggybank)
1. `pub async fn run(state: AppState, shutdown: CancellationToken) -> Result<()>`; spawn in
   `indexer-rs/src/main.rs:37-44`; declare in `sources/mod.rs`.
2. Feature gate `feature_<x>` (new `config.rs` field, `#[serde(default=default_true)]`).
3. Active gate: idle if no matching `active` asset in `state.assets`.
4. Cadence via `<x>_poll_ms` config; 30s for NAV/LST; `interval` + `MissedTickBehavior::Skip`.
5. Loop: `tokio::select!{ tick / shutdown.cancelled() }`; **errors `warn!`+continue, NEVER panic/propagate.**
6. RPC via `crate::rpc::get_account_with_fallback(&rpc, &rpc_fallback, &pk, "<low-cardinality-label>")`
   (primary + fallback; label is a fixed string, never an address).
7. **`rust_decimal` safety (F-12 class):** never `Decimal::new`; use `Decimal::try_new(...).ok()`,
   `checked_div/mul/pow`, guard `denominator.is_zero()`, return `None`/`Err` to skip the tick.
8. **Hand-decode** account structs (bounds-check then `u64::from_le_bytes(data[a..b].try_into()…)`);
   validate account discriminator/type byte + owner program; sanity-band the output. (Cargo borsh
   conflict `Cargo.toml:64-69` forbids pulling issuer/SDK crates — decode by offset.)
9. Sinks: `sinks::postgres::insert_intrinsic(...)` then `sinks::redis_pub::publish(SRC_<X>, payload)`;
   `meta` JSON carries the formula + raw inputs.
10. Metrics: `pegana_<x>_polls_total{status}`, `_latency_seconds`, a value gauge — **bounded label
    cardinality only** (no addresses/symbols-as-labels).
11. `Decimal→f64` for gauges via the local `decimal_to_f64` idiom.
12. **Two engine matches MUST be extended (compile-error guards by design):**
    `engine-rs/src/state.rs:162-168` `intrinsic_window_secs` → add the variant to the
    `Some(SOURCE_STALENESS_SECS)` arm; `derive_intrinsic` (:338-360) leaves it `_ => None` (source-fed).
13. Tests: captured `getAccountInfo` fixture under `crates/indexer-rs/fixtures/<x>/…json`, decode
    test asserting owner + pinned raw fields + NAV band; `rejects_wrong_type`/`rejects_mint_mismatch`.

### 2.2 Adapter: `sources/spl_stake_pool.rs`
**New variant** (`common-verify/src/lib.rs`, beside `SanctumLst`):
```rust
/// Generic SPL stake-pool LST not in the Sanctum registry. NAV(SOL/token) =
/// total_lamports / pool_token_supply from the StakePool state account (owned by
/// `program` — canonical SPL stake-pool OR a SanctumSpl fork; same layout).
SplStakePool { pool: String, program: String },
```
**On-chain `StakePool` layout (verified; data len ~611B):** `account_type` byte 0 == 1; `pool_mint`
@ off 162 (32B, must == LST mint); `total_lamports` @ off 258 (u64 LE); `pool_token_supply` @ off
266 (u64 LE); `last_update_epoch` @ off 274 (u64 LE). **NAV_sol = total_lamports / pool_token_supply;
value_usd = NAV_sol × Pyth(SOL/USD); also emit value_sol** (SOL-cancel path, sanctum.rs:153-168).
Two owner programs exist → the source/verify MUST check `account.owner == <per-asset program>`:
canonical `SPoo1Ku8WFXoNDMHPsrGSTSG1Y47rzgn41SLUNakuHy`, SanctumSpl `SP12tWFxD9oJsVWNavTTBZvMbA6gkAmxtVgxdqvyvhY`.
Do NOT add the `spl-stake-pool` crate (borsh conflict) — hand-decode.

**Build set — exactly 3 LSTs (fwdSOL/pdSOL/gtSOL DISCARDED by user decision 2026-06-23, their
real mints were unconfirmed). All 3 below verified on-chain (mint → StakePool state → owner program):**
| Display | Liq | Mint | StakePool state | Owner program |
|---|---|---|---|---|
| STKESOL | $66M | `stke7uu3fXHsGqKVVjKnkmj65LRPVrqr4bLG2SJg7rh` | `StKeDUdSu7jMSnPJ1MPqDnk3RdEwD2QbJaisHMebGhw` | `SPoo1Ku8WFXoNDMHPsrGSTSG1Y47rzgn41SLUNakuHy` (canonical SPL) |
| rkuSOL | $6.4M | `rkubjTrZYioRSeXwDnhwGQzvW3qkcin72JSxUt3WMVp` | `ERhozr6u9drmAANXGRNP1oh3quSqPKEwioKH5b8v9Kkt` | `SP12tWFxD9oJsVWNavTTBZvMbA6gkAmxtVgxdqvyvhY` (SanctumSpl) |
| corvusSOL | $2.5M | `CorvuSSoLxPKLoXWXSfn8pFSMhCRHhe7Uwqe874cmwvg` | `E5NXU96SgMEm49RBW8ZoAzs9MBr8fgxzLtypBNGKUS66` | `SP12tWFxD9oJsVWNavTTBZvMbA6gkAmxtVgxdqvyvhY` (SanctumSpl) |

> The adapter is anchored by STKESOL ($66M); rkuSOL/corvusSOL ride along once it exists. A final
> on-chain re-decode of all 3 StakePool accounts happens in the impl PR (fixtures = the live decode).

**`assets.toml` per confirmed-non-Sanctum LST:** `class="lst"`, `peg_target="SOL"`, `decimals=9`,
`token_program="spl"`, `intrinsic={kind="spl_stake_pool", pool="<state>", program="<owner>"}`,
`market={kind="jupiter_usd", numeraire="SOL", numeraire_feed="SOL/USD"}`, thresholds 55/140/300.
+ new `SRC_SPL_STAKE_POOL` channel, `feature_spl_stake_pool` flag, `spl_stake_pool_poll_ms` config.

**Tests:** fixtures `fixtures/spl_stake_pool/{stkesol,rkusol,corvussol}-pool.json`; assert owner,
pinned `total_lamports`/`pool_token_supply`, `pool_mint`==mint, NAV ∈ [1.0,1.2); + reject-wrong-type
+ reject-mint-mismatch.

---

## 3. Deferred / excluded (documented, not "left behind")
- **Perena USD\*** — DEFER. Numéraire curve-AMM; correct NAV needs the curve invariant from a
  4024-byte bytemuck `StablePool` (Seed pool `2w4A1eGyjRutakyFdmVyBiLPf98qKxNTC2LpuwhaCruZ`, program
  `NUMERUNsFCP3kuNmWZuXtm1AaQCPj9uw6Guv2Ekoi5P`). The existing `PerenaUsdStarPool{pool,underlying,
  program}` variant is the WRONG model (must be redesigned). ~$2.3k DEX liq → ~zero divergence
  signal. Multi-day RE. Revisit later as NAV-health-only.
- **fwdSOL ($133M) / pdSOL ($75M) / gtSOL ($43M)** — DISCARDED (2026-06-23): real mints were
  unconfirmed (an audit conflated them with unrelated Sanctum tokens dumSOL/aeroSOL). Revisit only
  if/when their canonical mints are positively identified.
- **mPST** (Huma Maxi) — optional future add; Pyth `MPST/USDC.RR` = `0x45bfbcaaf6bd4d0dd0e5e528baeefd7009b11100808fe16e4b11799289537185` exists if needed.
- The full SKIP set (deUSD/dSOL dead, phantom pools, ETH-only, FX-no-feed, sub-$1M dust) — catalog §Group 5.

## 4. Open questions (all resolved to a default)
- **Q1 (eUSX/PST denomination):** accept `.RR` as USD (underlying≈$1) — matches sUSDe/syrupUSDC precedent. ✅
- **Q2 (Jupiter):** RESOLVED → deploy with `JUPITER_MAX_CONCURRENT=2` (current keyed FREE tier, ~60s cycle, no payment). conc=4 (paid) → ~30s is OPTIONAL. Free keyed tier ends 2026-06-30 (then: pay → can do 4, or keyless conc=1 → ~120s). Not blocking.
- **Q3 (LST token_program):** confirmed `spl` for all 25 (live-checked). ✅
- **Q4 (Tier-2 LST mints):** RESOLVED — fwdSOL/pdSOL/gtSOL DISCARDED (2026-06-23); adapter covers only the 3 on-chain-verified LSTs (STKESOL/rkuSOL/corvusSOL). No pending mint verification.
- **Q5 (thresholds):** all provisional; 7-day `monitoring_only` window recalibrates.

## 5. Sequencing
1. **Tier 1** (§1) — ONE PR: 33 asset blocks + 7 `[pyth_feeds]` + 2 staleness overrides + migration
   `0053` + feed-coverage test + verify-assets + deploy `--migrate`. Confirm Q2 first.
2. **Tier 2 adapter** (§2) — `sources/spl_stake_pool.rs` for exactly STKESOL + rkuSOL + corvusSOL
   (the 3 on-chain-verified non-Sanctum LSTs). fwdSOL/pdSOL/gtSOL discarded.
3. **Perena** — deferred (§3).

## 6. Self-review — coverage vs catalog
- ✅ 6 stables, eUSX, PST (data-only), 25 LSTs — exact config + verified mints/feeds/thresholds.
- ✅ The §1.4 `[pyth_feeds]` + staleness gap (v1's fatal flaw) — closed, with a guard test (§1.7.2).
- ✅ Enum/DB/verify/engine/jupiter/cold-start — all verified by the 5 audits, citations inline.
- ✅ Tier-2 adapter — house-style checklist + StakePool layout + per-asset owner-program + tests;
  3 on-chain-verified LSTs (STKESOL/rkuSOL/corvusSOL); fwdSOL/pdSOL/gtSOL discarded (Q4 resolved).
- ✅ Perena deferred with the real reason (wrong model + zero signal), Huma collapsed to data-only.
- ✅ SKIP set documented in the catalog (not silently dropped).
- ⚠️ Remaining pre-impl gate: ONLY Q2 (Jupiter paid plan / `JUPITER_MAX_CONCURRENT=4`) — a deploy-time env value, does not block writing-plans or coding.
```
